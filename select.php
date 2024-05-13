<?php
    try {
        require 'configDB.php';

        $sql = "SELECT * FROM employees";
        foreach ($databasehandler->query($sql) as $row) {
            print "<br/>";
            print $row['id'] . '-' . $row['fio'] . '-' . $row['hire_date'] . '-' . $row['termination_date'] . '<br/>';
        }
    }catch (PDOException $e) {

        echo $e->getMessage();
    }
    ?>