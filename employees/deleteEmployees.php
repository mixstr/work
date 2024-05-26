<?php
    require_once(dirname(__FILE__) . '/../configDB.php');
    $sql = file_get_contents(dirname(__FILE__) . '/../sql/deleteEmployees.sql');
    $monthIDtoCascadeDelete = array();
    $arguments= [
        'id' => $_GET['id']
    ];
    $sql2 = file_get_contents(dirname(__FILE__) . '/../sql/cascadeMonthToEmployees.sql');
    global $databasehandler;
    execution($sql2, $arguments);
    $monthIDtoCascadeDelete = $databasehandler->query($sql2)->fetchAll(PDO::FETCH_COLUMN);
    $monthIDtoCascadeDelete = array_unique($monthIDtoCascadeDelete);
    $sql3 = file_get_contents(dirname(__FILE__) . '/../sql/deleteEmployeesCascadeMonth.sql');
    foreach ($monthIDtoCascadeDelete as &$value){
        execution($sql3, $value);
    }
    $sql4 = file_get_contents(dirname(__FILE__) . '/../sql/deleteEmployeesCascadeCoefficient.sql');
    execution($sql4, $arguments);
    execution($sql, $arguments);
?>