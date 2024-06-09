<?php
    require_once(dirname(__DIR__) . '/configDB.php');
    $sqlCoefficentID = file_get_contents(dirname(__DIR__) . '/sql/deleteCoefficient.sql');
    $sqlCascade = file_get_contents(dirname(__DIR__) . '/sql/deleteCoefficientCascade.sql');
    $arguments= [
        'id' => $_GET['id']
    ];
    execution($sqlCoefficentID, $arguments);
    execution($sqlCascade, $arguments);
?>
