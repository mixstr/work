<?php
    require_once(dirname(__FILE__) . '/../configDB.php');
    $sql = file_get_contents(dirname(__FILE__) . '/../sql/deleteCoefficient.sql');
    $sql2 = file_get_contents(dirname(__FILE__) . '/../sql/deleteCoefficientCascade.sql');
    $arguments= [
        'id' => $_GET['id']
    ];
    execution($sql, $arguments);
    execution($sql, $arguments);
?>